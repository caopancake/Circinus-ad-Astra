import { nextTick } from 'vue';

export async function focusFieldInput(element: HTMLElement | null) {
  if (!element) return;
  for (const ancestor of ancestorsOf(element)) {
    if (ancestor.classList.contains('section-fields') && ancestor.style.display === 'none') {
      (ancestor.previousElementSibling as HTMLElement).click();
    }
    if (ancestor.classList.contains('n-collapse-item') && !ancestor.classList.contains('n-collapse-item--active')) {
      ancestor.querySelector<HTMLElement>('.n-collapse-item__header')?.click();
    }
  }
  await nextTick();
  element.scrollIntoView?.({ block: 'nearest' });
  element.focus();
}

function* ancestorsOf(element: HTMLElement): Generator<HTMLElement> {
  let ancestor = element.parentElement;
  while (ancestor) {
    yield ancestor;
    ancestor = ancestor.parentElement;
  }
}
