export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export function onClick(selector, cb) {
  document.addEventListener("click", (e) => {
    if (e.target.closest(selector)) {
      cb(e, e.target.closest(selector));
    }
  });
}