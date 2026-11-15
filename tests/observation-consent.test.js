import test from 'node:test';
import assert from 'node:assert/strict';
import { BodyController } from '../src/body-controller.js';

test('withdrawing observation consent while a model is loading prevents a late enabled callback',async()=>{
 const emitted=[];let resolveModel;
 const controller=new BodyController({video:{},overlay:null,onObservation:v=>emitted.push(v)});
 controller.active=true;
 controller.faceObserver={start:()=>new Promise(resolve=>{resolveModel=resolve;}),stop:()=>{}};
 const loading=controller.enableObservations(true);
 await controller.enableObservations(false);
 const withdrawalIndex=emitted.length;
 resolveModel(true);
 assert.equal(await loading,false);
 assert.equal(controller.observationEnabled,false);
 assert.equal(controller.faceReady,false);
 assert.equal(emitted.slice(withdrawalIndex).some(v=>v.enabled),false);
});
