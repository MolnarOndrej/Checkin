const feedbackDuration = 4000;
const clearTimers = new WeakMap();

export function showFeedback(element, message = '', error = false) {
  clearTimeout(clearTimers.get(element));
  clearTimers.delete(element);
  element.textContent = message;
  element.toggleAttribute('data-error', error);

  if (message) {
    clearTimers.set(element, setTimeout(() => showFeedback(element), feedbackDuration));
  }
}
