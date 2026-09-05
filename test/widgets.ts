/**
 * The elements the two keyboard widgets are built on, and the gestures a reader makes.
 *
 * The tests that use this run in happy-dom. It moves focus, dispatches events and answers
 * `document.activeElement`, which is what the widgets are about. A stub that recorded
 * `focus()` would agree with whatever the widget did with it.
 *
 * Nothing here reaches into a widget. A test clicks, presses a key, or types, the way a
 * reader does.
 */

/** The input and list a `Combobox` is built on, in the document. */
export function comboboxElements(): { input: HTMLInputElement; list: HTMLUListElement } {
  const input = document.createElement("input")
  const list = document.createElement("ul")
  document.body.append(input, list)
  return { input, list }
}

/** The input and row a `RenameBox` is built on, in the document. */
export function renameElements(): { input: HTMLInputElement; row: HTMLButtonElement } {
  const input = document.createElement("input")
  const row = document.createElement("button")
  document.body.append(input, row)
  return { input, row }
}

/** Type into a box, the way a keystroke reaches it. */
export function type(input: HTMLInputElement, text: string): void {
  input.value = text
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

/** Press a key in a box. The modifiers are the ones the widgets read. */
export function press(
  input: HTMLInputElement,
  key: string,
  modifiers: Partial<KeyboardEventInit> = {},
): void {
  input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...modifiers }))
}

/** The rows a combobox has painted, as their text. */
export const rowsIn = (list: HTMLUListElement): string[] =>
  [...list.querySelectorAll("li")].map((row) => row.textContent ?? "")

/** Which row holds the highlight, or -1 when none does. */
export const highlighted = (list: HTMLUListElement): number =>
  [...list.querySelectorAll("button")].findIndex((row) => row.dataset["on"] === "true")

/** Click a row with the mouse. The rows listen for mousedown, not click. */
export function clickRow(list: HTMLUListElement, index: number, meta = false): void {
  const row = list.querySelectorAll("button")[index]
  row?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, metaKey: meta }))
}

/** Empty the document between tests, so one test's elements cannot answer another's query. */
export function clearPage(): void {
  document.body.replaceChildren()
}
