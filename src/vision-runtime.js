// OpenCV's legacy Emscripten build leaves its self-returning thenable as the
// global Module. MediaPipe treats Module as configuration for a NEW runtime;
// passing OpenCV's live runtime there causes endless Promise assimilation.
// cv keeps the existing runtime alive; clear only that foreign configuration.
export function clearForeignOpenCvModule(scope=globalThis) {
 const runtime=scope.Module;
 if(runtime && typeof runtime.then==='function' && runtime.Mat && (runtime===scope.cv || runtime.imread)) {
  scope.Module=undefined;
  return true;
 }
 return false;
}
