export function render(el: HTMLElement, s: string): void {
  // eslint-disable-next-line platform/no-innerhtml -- TASK-123
  el.innerHTML = s;
}
