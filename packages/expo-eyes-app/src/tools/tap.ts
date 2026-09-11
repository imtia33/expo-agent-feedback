/**
 * Tap / longPress tools — fire press events on a target element.
 *
 * Strategy (Layer 3 synthesis, Pressability lifecycle):
 *   1. Find the fiber by ref
 *   2. Walk up to find a host component with a pressable props bag
 *      (has onPress / onPressIn / onPressOut / onLongPress)
 *   3. Fire the lifecycle:
 *      - tap:        onPressIn → onPressOut → onPress
 *      - longPress:  onPressIn → (wait durationMs) → onLongPress → onPressOut
 *
 * This is what React Native Testing Library does. It works because
 * Pressable / TouchableOpacity / Button all expose these callbacks
 * directly via props.
 *
 * Limitations (be honest):
 *  - Skips the native responder chain — components using the raw
 *    Gesture Responder System (onStartShouldSetResponder etc.) won't
 *    see the press
 *  - No real touch coordinates — onPressIn/onPressOut events are
 *    synthetic with empty pageX/pageY. Most components don't read these.
 *  - For gesture-handler-based components, use the dedicated pinch/swipe
 *    tools (v2) instead of tap.
 */

import { findFiberByRef } from '../tree-serializer';

function makeSyntheticPressEvent(fiber: any) {
  // Minimal event shape that Pressability / Pressable expects
  const nativeEvent = {
    locationX: 0,
    locationY: 0,
    pageX: 0,
    pageY: 0,
    timestamp: Date.now(),
    identifier: 1,
    target: 0, // we don't have reactTag here in v1
  };
  return {
    nativeEvent,
    currentTarget: null,
    target: null,
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
    type: 'press',
  };
}

function findPressableFiber(fiber: any): any {
  let current: any = fiber;
  let iterations = 0;
  while (current && iterations < 30) {
    const props = current.memoizedProps;
    if (props && typeof props === 'object') {
      if (typeof props.onPress === 'function' ||
          typeof props.onPressIn === 'function' ||
          typeof props.onPressOut === 'function' ||
          typeof props.onLongPress === 'function') {
        return current;
      }
    }
    current = current.return;
    iterations++;
  }
  return null;
}

export async function tap(args: Record<string, any>): Promise<{ ok: boolean; refsStillValid: boolean }> {
  const ref = args.ref;
  if (typeof ref !== 'string' || !ref) {
    throw Object.assign(new Error('tap requires args.ref (string)'), { code: 'BAD_ARGS' });
  }

  const found = findFiberByRef(ref);
  if (!found) {
    throw Object.assign(new Error(`ref "${ref}" not found — call inspect() to refresh.`), { code: 'REF_NOT_FOUND' });
  }

  const pressableFiber = findPressableFiber(found.fiber);
  if (!pressableFiber) {
    throw Object.assign(
      new Error(`No pressable handler found for ref "${ref}" (walked up 30 ancestors). The element may not be tappable, or it uses a custom gesture system.`),
      { code: 'NOT_TAPPABLE' },
    );
  }

  const props = pressableFiber.memoizedProps;
  const event = makeSyntheticPressEvent(pressableFiber);

  // Fire lifecycle: onPressIn → onPressOut → onPress
  if (typeof props.onPressIn === 'function') {
    try { props.onPressIn(event); } catch (e) { /* swallow — component error */ }
  }
  if (typeof props.onPressOut === 'function') {
    try { props.onPressOut(event); } catch (e) { /* swallow */ }
  }
  if (typeof props.onPress === 'function') {
    try { props.onPress(event); } catch (e) { /* swallow */ }
  }

  // Taps usually don't invalidate refs unless they trigger navigation
  return { ok: true, refsStillValid: true };
}

export async function longPress(args: Record<string, any>): Promise<{ ok: boolean; refsStillValid: boolean }> {
  const ref = args.ref;
  const durationMs = typeof args.durationMs === 'number' ? args.durationMs : 500;
  if (typeof ref !== 'string' || !ref) {
    throw Object.assign(new Error('longPress requires args.ref (string)'), { code: 'BAD_ARGS' });
  }

  const found = findFiberByRef(ref);
  if (!found) {
    throw Object.assign(new Error(`ref "${ref}" not found — call inspect() to refresh.`), { code: 'REF_NOT_FOUND' });
  }

  const pressableFiber = findPressableFiber(found.fiber);
  if (!pressableFiber) {
    throw Object.assign(
      new Error(`No pressable handler found for ref "${ref}".`),
      { code: 'NOT_TAPPABLE' },
    );
  }

  const props = pressableFiber.memoizedProps;
  const event = makeSyntheticPressEvent(pressableFiber);

  if (typeof props.onPressIn === 'function') {
    try { props.onPressIn(event); } catch {}
  }

  // Wait the long-press duration
  await new Promise((resolve) => setTimeout(resolve, durationMs));

  if (typeof props.onLongPress === 'function') {
    try { props.onLongPress(event); } catch {}
  } else if (typeof props.onPress === 'function') {
    // Fall back to press if longPress not defined
    try { props.onPress(event); } catch {}
  }

  if (typeof props.onPressOut === 'function') {
    try { props.onPressOut(event); } catch {}
  }

  return { ok: true, refsStillValid: true };
}
