import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackingRecovery } from '../src/tracking-recovery.js';

test('brief missing poses do not pause the flight', () => {
  const events = [];
  const tracking = new TrackingRecovery({onInterrupt: () => events.push('pause'), onRecover: () => events.push('resume')});
  tracking.observe('lost', 0);
  tracking.tick(1500);
  tracking.observe('tracking', 1600);
  tracking.tick(3000);
  assert.deepEqual(events, []);
});

test('sustained tracking loss pauses once and automatically recovers once', () => {
  const events = [];
  const tracking = new TrackingRecovery({onInterrupt: () => events.push('pause'), onRecover: () => events.push('resume')});
  tracking.observe('lost', 0);
  tracking.tick(1800);
  tracking.observe('lost', 2000);
  tracking.tick(4000);
  tracking.observe('tracking', 4100);
  tracking.observe('tracking', 4200);
  assert.deepEqual(events, ['pause', 'resume']);
});

test('manual pause or hidden tab cancels automatic recovery until tracking returns', () => {
  let resumes = 0, pauses = 0;
  const tracking = new TrackingRecovery({onInterrupt: () => pauses++, onRecover: () => resumes++});
  tracking.observe('lost', 0);
  tracking.tick(1800);
  tracking.cancel();
  tracking.observe('lost', 2000);
  tracking.tick(5000);
  tracking.observe('tracking', 6000);
  assert.equal(pauses, 1);
  assert.equal(resumes, 0);
  tracking.observe('lost', 7000);
  tracking.tick(8800);
  tracking.observe('tracking', 9000);
  assert.equal(resumes, 1);
});
