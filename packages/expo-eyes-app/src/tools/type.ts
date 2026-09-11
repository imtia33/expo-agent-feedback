/**
 * type tool — set text in a TextInput.
 *
 * Strategy:
 *   1. Find the fiber by ref
 *   2. Walk up to find a host TextInput (or self)
 *   3. Set the value via the React-controlled pattern:
 *      - Call props.onChangeText with the new text (Layer 4)
 *      - If the input is uncontrolled, call props.onChange with a synthetic event
 *
 * This works for React-controlled TextInputs (the vast majority).
 * For uncontrolled inputs that rely on native state, we'd need a native
 * module (dev build) — but those are rare.
 *
 * Args:
 *  - ref: string (required)
 *  - text: string (required) — replaces the entire value (use append? for v2)
 *  - append?: boolean — if true, append to existing value instead of replace
 */

import { findFiberByRef } from '../tree-serializer';

function findTextInputFiber(fiber: any): any {
  let current: any = fiber;
  let iterations = 0;
  while (current && iterations < 30) {
    const typeName = current?.elementType?.displayName || current?.type?.displayName || current?.type?.name;
    if (typeName === 'TextInput' || typeName === 'RCTTextInput' || typeName === 'AndroidTextInput') {
      return current;
    }
    current = current.return;
    iterations++;
  }
  return null;
}

function makeSyntheticChangeEvent(text: string) {
  return {
    nativeEvent: { text, target: 0, eventCount: 0 },
    text,
    target: null,
    currentTarget: null,
    bubbles: false,
    cancelable: false,
    defaultPrevented: false,
    eventPhase: 0,
    isTrusted: false,
    isDefaultPrevented: () => false,
    isPropagationStopped: () => false,
    persist: () => {},
    preventDefault: () => {},
    stopPropagation: () => {},
    timeStamp: Date.now(),
    type: 'changeText',
  };
}

export async function type(args: Record<string, any>): Promise<{ ok: boolean; refsStillValid: boolean; newValue: string }> {
  const ref = args.ref;
  const text = args.text;
  const append = args.append === true;

  if (typeof ref !== 'string' || !ref) {
    throw Object.assign(new Error('type requires args.ref (string)'), { code: 'BAD_ARGS' });
  }
  if (typeof text !== 'string') {
    throw Object.assign(new Error('type requires args.text (string)'), { code: 'BAD_ARGS' });
  }

  const found = findFiberByRef(ref);
  if (!found) {
    throw Object.assign(new Error(`ref "${ref}" not found — call inspect() to refresh.`), { code: 'REF_NOT_FOUND' });
  }

  const textInputFiber = findTextInputFiber(found.fiber);
  if (!textInputFiber) {
    throw Object.assign(
      new Error(`No TextInput found at or above ref "${ref}". Make sure you're pointing at a TextInput.`),
      { code: 'NOT_TEXT_INPUT' },
    );
  }

  const props = textInputFiber.memoizedProps;

  // Determine the new value
  const currentValue = typeof props.value === 'string' ? props.value :
                       typeof props.defaultValue === 'string' ? props.defaultValue :
                       '';
  const newValue = append ? currentValue + text : text;

  // Fire onChangeText (the React-way)
  if (typeof props.onChangeText === 'function') {
    try { props.onChangeText(newValue); } catch (e) { /* swallow */ }
  }

  // Fire onChange with synthetic event (some components use this instead)
  if (typeof props.onChange === 'function') {
    try { props.onChange(makeSyntheticChangeEvent(newValue)); } catch (e) { /* swallow */ }
  }

  return {
    ok: true,
    refsStillValid: true,
    newValue,
  };
}
