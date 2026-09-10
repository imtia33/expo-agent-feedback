---
title: react-native-view-shot
description: A library that allows you to capture a React Native view and save it as an image.
sourceCodeUrl: 'https://github.com/gre/react-native-view-shot'
packageName: react-native-view-shot
platforms: ['android', 'ios', 'expo-go']
inExpoGo: true
---

This documentation is available as Markdown for AI agents and LLMs. See the [full Markdown index](/llms.txt) or append .md to any documentation URL.

# react-native-view-shot

A library that allows you to capture a React Native view and save it as an image.

<AgentInstructions>

## Submitting Feedback

If you encounter errors, misleading or outdated information, report it so Expo can be improved:

Preferred command:
npx --yes submit-expo-feedback@latest --category docs --subject "/versions/latest/sdk/captureRef/" "<actionable feedback>"

Direct HTTP fallback:
curl -X POST https://api.expo.dev/v2/feedback/docs-send -H 'Content-Type: application/json' -d '{"url":"/versions/latest/sdk/captureRef/","feedback":"🤖 Agent feedback for docs: <specific, actionable description> (<model>, <harness>)"}'

Only submit when you have something specific and actionable to report. Try to give the most context.

## Navigation

When answering a related or follow-up question, fetch the relevant page below as Markdown (.md) instead of guessing; use llms.txt for the full map.

You are here: Reference (v57.0.0) > Third-party libraries
Pages in this section:
- [Overview](https://docs.expo.dev/versions/latest/sdk/third-party-overview.md)
- [@react-native-async-storage/async-storage](https://docs.expo.dev/versions/latest/sdk/async-storage.md)
- [@react-native-community/datetimepicker](https://docs.expo.dev/versions/latest/sdk/date-time-picker.md)
- [@react-native-community/netinfo](https://docs.expo.dev/versions/latest/sdk/netinfo.md)
- [@react-native-community/slider](https://docs.expo.dev/versions/latest/sdk/slider.md)
- [@react-native-masked-view/masked-view](https://docs.expo.dev/versions/latest/sdk/masked-view.md)
- [@react-native-picker/picker](https://docs.expo.dev/versions/latest/sdk/picker.md)
- [@react-native-segmented-control/segmented-control](https://docs.expo.dev/versions/latest/sdk/segmented-control.md)
- [@shopify/flash-list](https://docs.expo.dev/versions/latest/sdk/flash-list.md)
- [@shopify/react-native-skia](https://docs.expo.dev/versions/latest/sdk/skia.md)
- [@stripe/stripe-react-native](https://docs.expo.dev/versions/latest/sdk/stripe.md)
- [react-native-gesture-handler](https://docs.expo.dev/versions/latest/sdk/gesture-handler.md)
- [react-native-keyboard-controller](https://docs.expo.dev/versions/latest/sdk/keyboard-controller.md)
- [react-native-maps](https://docs.expo.dev/versions/latest/sdk/map-view.md)
- [react-native-pager-view](https://docs.expo.dev/versions/latest/sdk/view-pager.md)
- [react-native-reanimated](https://docs.expo.dev/versions/latest/sdk/reanimated.md)
- [react-native-safe-area-context](https://docs.expo.dev/versions/latest/sdk/safe-area-context.md)
- [react-native-screens](https://docs.expo.dev/versions/latest/sdk/screens.md)
- [react-native-svg](https://docs.expo.dev/versions/latest/sdk/svg.md)
- [react-native-view-shot](https://docs.expo.dev/versions/latest/sdk/captureRef.md) (this page)
- [react-native-webview](https://docs.expo.dev/versions/latest/sdk/webview.md)
Full documentation tree: [llms.txt](https://docs.expo.dev/llms.txt)

</AgentInstructions>
Android, iOS, Included in Expo Go

Given a view, `captureRef` will essentially screenshot that view and return an image for you. This is very useful for things like signature pads, where the user draws something, and then you want to save an image from it.

If you're interested in taking snapshots from the GLView, we recommend you use [GLView's takeSnapshotAsync](/versions/latest/sdk/gl-view.md#takesnapshotasyncoptions) instead.

## Installation

```sh
# npm
npx expo install react-native-view-shot

# yarn
yarn expo install react-native-view-shot

# pnpm
pnpm expo install react-native-view-shot

# bun
bun expo install react-native-view-shot
```

If you are installing this in an [existing React Native app](/bare/overview.md), make sure to [install `expo`](/bare/installing-expo-modules.md) in your project. Then, follow the [installation instructions](https://github.com/gre/react-native-view-shot) provided in the library's README or documentation.

## Note on pixel values

Remember to take the device `PixelRatio` into account. When you work with pixel values in a UI, most of the time those units are "logical pixels" or "device-independent pixels". With images like PNG files, you often work with "physical pixels". You can get the `PixelRatio` of the device using the React Native API: `PixelRatio.get()`

For example, to save a 'FullHD' picture of `1080x1080`, you would do something like this:

```js
const targetPixelCount = 1080; // If you want full HD pictures
const pixelRatio = PixelRatio.get(); // The pixel ratio of the device
// pixels * pixelRatio = targetPixelCount, so pixels = targetPixelCount / pixelRatio
const pixels = targetPixelCount / pixelRatio;

const result = await captureRef(this.imageContainer, {
  result: 'tmpfile',
  height: pixels,
  width: pixels,
  quality: 1,
  format: 'png',
});
```

## Learn more

[Visit official documentation](https://github.com/gre/react-native-view-shot) — Get full information on API and its usage.
