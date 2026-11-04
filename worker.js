'use strict';
const {parentPort, workerData} = require('node:worker_threads');
const {Service} = require('./lib/service');
const service = new Service(workerData.root, workerData.data, progress => parentPort.postMessage({progress}));
const pending = new Set();
parentPort.on('message', async ({id, op, args}) => {
  if (op === 'shutdown') {
    service.closing = true; service.controller?.abort(); require('./lib/audio').stopDecoders();
    await Promise.allSettled([...pending]); parentPort.postMessage({id, result: true}); return;
  }
  const job = service.handle(op, args); pending.add(job);
  try { parentPort.postMessage({id, result: await job}); }
  catch (error) { parentPort.postMessage({id, error: error.message}); }
  finally { pending.delete(job); }
});
