import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHandlers } from '../src/http.ts'
import type { BatchStatus, UpdateStatus } from '../src/types.ts'
const base = (): BatchStatus => ({ busy: false, phase: 'idle', total: 0, completed: 0, candidates: ['a'], protected: [], pendingRestore: ['a'], snapshotCreatedAt: '2026-10-30T00:00:00.000Z', results: [], lastError: null })
const idle = (): UpdateStatus => ({ busy:false,phase:'idle',total:0,completed:0,current:null,stage:null,results:[],lastError:null,startedAt:null,finishedAt:null,stopRequested:false })
const legacy = () => ({ status: async () => base(), disable: async () => {}, restore: async () => {}, dispose() {} })
const post = () => new Request('http://localhost/api/dsh-plugin-batch-toggle/update', { method:'POST' })
test('one-click update accepts legacy recovery and excludes concurrent mutations', async () => {
  let release!:()=>void; const wait=new Promise<void>(resolve=>{release=resolve}); const state=idle()
  const handlers=createHandlers(legacy(), { status: async()=>state, run: async()=>{state.busy=true;await wait;state.busy=false},stop:async()=>{},dispose(){} })
  assert.equal((await handlers.update(post())).status,202)
  assert.equal((await handlers.update(post())).status,409)
  assert.equal((await handlers.restore(post())).status,409)
  assert.equal((await handlers.status()).status,200)
  release(); handlers.dispose()
})
test('stop is acknowledged without waiting for the current installation to settle',async()=>{
  const state=idle(); state.busy=true;state.phase='updating';state.current='a';state.stage='installing'
  const handlers=createHandlers(legacy(),{status:async()=>state,run:async()=>{},stop:async()=>{state.stopRequested=true;await new Promise<void>(()=>{})},dispose(){}})
  assert.equal((await handlers.stop(post())).status,202)
  const response=await handlers.status();const body=await response.json()
  assert.equal(body.busy,true);assert.equal(body.phase,'updating');assert.equal(body.update.current,'a')
  handlers.dispose()
})
test('an absent updater fails clearly while old endpoints remain compatible',async()=>{
  const handlers=createHandlers(legacy())
  assert.equal((await handlers.update(post())).status,503)
  assert.equal((await handlers.stop(post())).status,503)
  handlers.dispose()
})
test('disposed and read-only update requests cannot mutate packages',async()=>{
  const handlers=createHandlers(legacy(),{status:async()=>idle(),run:async()=>{throw new Error('must not run')},stop:async()=>{},dispose(){}})
  assert.equal((await handlers.update(new Request('http://localhost'))).status,405)
  handlers.dispose(); assert.equal((await handlers.update(post())).status,503)
})
test('legacy mutation rechecks exclusivity after an asynchronous updater status read',async()=>{
  let releaseStatus!:(value:UpdateStatus)=>void; let calls=0
  const gate=new Promise<UpdateStatus>(resolve=>{releaseStatus=resolve})
  const old=legacy();old.status=async()=>({...base(),pendingRestore:[],snapshotCreatedAt:null})
  const handlers=createHandlers(old,{status:async()=>++calls===1?gate:idle(),run:async()=>new Promise<void>(()=>{}),stop:async()=>{},dispose(){}})
  const pending=handlers.disable(post())
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal((await handlers.update(post())).status,202)
  releaseStatus(idle())
  assert.equal((await pending).status,409)
  handlers.dispose()
})
