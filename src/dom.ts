/**
 * Typed DOM helper — retrieves an element by id and asserts it matches the
 * expected HTMLElement subtype. Throws at runtime if the element is missing,
 * so every caller can rely on a non-null reference without using `!` or `any`.
 */
export function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) {
    throw new Error(`Required element #${id} not found in DOM`);
  }
  return el as T;
}
