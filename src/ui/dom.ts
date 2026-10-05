type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

/** Tiny element builder: el('div.cls', { onclick: fn, style: '...' }, children). */
export function el<K extends keyof HTMLElementTagNameMap>(spec: K | `${K}.${string}`, attrs: Attrs = {}, children: (Node | string | null | undefined)[] = []) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag as K);
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'html') node.innerHTML = String(v);
    else if (k === 'text') node.textContent = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}

export const clear = (n: Element) => {
  while (n.firstChild) n.removeChild(n.firstChild);
};
