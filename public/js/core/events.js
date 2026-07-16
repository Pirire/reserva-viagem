const events = {};

export function on(event, cb) {
  if (!events[event]) events[event] = [];
  events[event].push(cb);
}

export function emit(event, data) {
  if (!events[event]) return;
  events[event].forEach(cb => cb(data));
}

export function initEvents() {
  console.log("📡 Event system ready");
}