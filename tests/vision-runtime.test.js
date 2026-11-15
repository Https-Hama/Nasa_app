import test from 'node:test';
import assert from 'node:assert/strict';
import {clearForeignOpenCvModule} from '../src/vision-runtime.js';

test('OpenCV runtime is retained while its foreign MediaPipe configuration global is cleared',()=>{
 const cv={Mat:class{},imread:()=>{},then(resolve){resolve(this);}};const scope={cv,Module:cv};assert.equal(clearForeignOpenCvModule(scope),true);assert.equal(scope.Module,undefined);assert.equal(scope.cv,cv);assert.equal(typeof scope.cv.Mat,'function');
});
test('ordinary MediaPipe initialization options are never erased',()=>{
 for(const Module of [{locateFile:()=>''},{then:()=>{},model:'other'},undefined]){const scope={Module};assert.equal(clearForeignOpenCvModule(scope),false);assert.equal(scope.Module,Module);}
});
