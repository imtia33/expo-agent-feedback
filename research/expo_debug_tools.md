---
modificationDate: August 10, 2026
title: Debugging and profiling tools
description: Learn about different tools available to inspect your Expo project at runtime.
---

This documentation is available as Markdown for AI agents and LLMs. See the [full Markdown index](/llms.txt) or append .md to any documentation URL.

# Debugging and profiling tools

Learn about different tools available to inspect your Expo project at runtime.

<AgentInstructions>

## Submitting Feedback

If you encounter errors, misleading or outdated information, report it so Expo can be improved:

Preferred command:
npx --yes submit-expo-feedback@latest --category docs --subject "/debugging/tools/" "<actionable feedback>"

Direct HTTP fallback:
curl -X POST https://api.expo.dev/v2/feedback/docs-send -H 'Content-Type: application/json' -d '{"url":"/debugging/tools/","feedback":"🤖 Agent feedback for docs: <specific, actionable description> (<model>, <harness>)"}'

Only submit when you have something specific and actionable to report. Try to give the most context.

## Navigation

When answering a related or follow-up question, fetch the relevant page below as Markdown (.md) instead of guessing; use llms.txt for the full map.

You are here: Home > Develop > Debugging
Pages in this section:
- [Errors and warnings](https://docs.expo.dev/debugging/errors-and-warnings.md)
- [Runtime issues](https://docs.expo.dev/debugging/runtime-issues.md)
- [Tools](https://docs.expo.dev/debugging/tools.md) (this page)
- [Dev tools plugins](https://docs.expo.dev/debugging/devtools-plugins.md)
- [Create a dev tools plugin](https://docs.expo.dev/debugging/create-devtools-plugins.md)
Full documentation tree: [llms.txt](https://docs.expo.dev/llms.txt)

</AgentInstructions>

React Native consists of both JavaScript and native code. Making this distinction is very important when it comes to debugging. If an error is thrown from the JavaScript code, you might not find it using debugging tools for native code. This page lists a few tools to help you debug your Expo project.

## Developer menu

The **Developer menu** provides access to useful debugging functions. It is built into dev clients and Expo Go. If you are using an emulator, simulator, or have a device connected via USB, you can open this menu by pressing M in the terminal where Expo CLI has started the development server.

#### Alternative options to open the Developer menu

-   Android device (without USB): Shake the device vertically.
    
-   Android Emulator or device (with USB):
    
    -   Press Cmd ⌘ + M or Ctrl + M.
    -   Run the following command in the terminal to simulate pressing the menu button:
        
        ```sh
        adb shell input keyevent 82
        ```
        
-   iOS device (without USB):
    
    -   Shake the device.
    -   Touch three fingers to the screen.
-   iOS Simulator or device (with USB):
    
    -   Press Ctrl + Cmd ⌘ + Z or Cmd ⌘ + D

Once the Developer menu is open, it will appear as below:

Image: The Expo Go Developer Menu, showing the menu options available.

The Developer menu provides the following options:

-   **Copy link**: To copy the dev server address of your app.
-   **Reload**: To reload you app. Usually, not necessary since Fast Refresh is enabled by default.
-   **Go Home**: To leave your app and navigate back to the dev client's or Expo Go app's Home screen.
-   **Toggle performance monitor**: To view the performance information about your app.
-   **Toggle element inspector**: To enable or disable the element inspector overlay.
-   **Open DevTools** (formerly **Open JS debugger**): To open React Native DevTools which provides access to Console, Sources, Network (**Expo only**), Memory, Components, and Profiler, tabs for apps using Hermes. For more information, see the [Debugging with React Native DevTools](/debugging/tools.md#debugging-with-react-native-devtools) section.
-   **Fast Refresh**: To toggle automatic refreshing of the JS bundle whenever you make changes to files in your project using a text editor.

Now, let's explore some of these options in details.

### Toggle performance monitor

Opens up a small overlay that provides the following performance information about your app:

-   RAM usage of a project.
-   JavaScript heap (this is an easy way to know of any memory leaks in your application).
-   Two Views. The top indicates the number of views for the screen and the bottom indicates the number of views in the component.
-   Frames Per Second for the UI and JS threads. The UI thread is used for native Android or iOS UI rendering. The JS thread is where most of your logic runs, including API calls, touch events, and so on.

### Toggle element inspector

Opens up the element inspector overlay:

Image: The element inspector overlay which shows details about an element after inspecting it.

This overlay has capabilities to:

-   Inspect: Inspect elements
-   Perf: Show Performance overlay
-   Network: Show network details
-   Touchables: Highlight touchable elements

## Debugging with React Native DevTools

> **Starting from React Native 0.76**, React Native DevTools has replaced Chrome DevTools.

**React Native DevTools** is a modern debugging tool for Expo and React Native apps. It allows you to gain insights into the JavaScript code of your app by accessing the [Console](/debugging/tools.md#interacting-with-the-console), [Sources](/debugging/tools.md#pausing-on-breakpoints), [Network](/debugging/tools.md#inspecting-network-requests-expo-only) (**Expo only**), and [Memory](/debugging/tools.md#inspecting-memory) tabs. It also has **built-in support for React DevTools** such as [Components](/debugging/tools.md#inspecting-components) and [Profiler](/debugging/tools.md#profiling-javascript-performance) tabs. All of these inspectors can be accessed using [dev clients](/more/glossary-of-terms.md#dev-clients) or Expo Go.

You can use the React Native DevTools on any app using [Hermes](/guides/using-hermes.md). **To open it, start your app and press J in the terminal where Expo was started**. Once you have opened the React Native DevTools, it will appear as below:

Image: The React Native DevTools showing one of the files under the Sources tab.

### Pausing on breakpoints

You can pause your app on specific parts of your code. To do this, set the breakpoint under the Sources tab by clicking the line number or add the `debugger` statement in your code.

Once your app is executing code that has a breakpoint, it will entirely pause your app. This allows you to inspect all variables and functions in that scope. You can also execute code in the [Console](/debugging/tools.md#interacting-with-the-console) tab as part of your app.

Image: The React Native DevTools showing one of the files under the Sources tab.

### Pausing on exceptions

If your app throws unexpected errors, it can be hard to find the source of the error. You can use React Native DevTools to pause your app and inspect the stack trace and variables the moment it throws an error.

Image: Enable Pause on exceptions in the right panel of the Sources tab.

> Some errors might be caught by other components in your app, such as Expo Router. In these cases, you can turn on **Pause on caught exceptions**. It will enable you to inspect any thrown error, even when handled properly.

### Interacting with the console

The **Console** tab gives you access to an interactive terminal, connected directly to your app. You can write any JavaScript inside this terminal to execute snippets of code as if it were part of your app. The code is executed in the global scope by default. But, when using breakpoints from the [Sources](/debugging/tools.md#pausing-on-breakpoints) tab, it executes in the scope of the reached breakpoint. This allows you to invoke methods and access variables throughout your app.

Image: Use the console with breakpoints to inspect variables and invoke code through your app.

### Inspecting network requests (Expo only)

> The Network tab in React Native DevTools is only available when you have [`expo-dev-client`](/versions/latest/sdk/dev-client.md) installed, or when you use Expo Go.

The **Network** tab gives you insights into the network requests made by your app. You can inspect each request and response by clicking on them. This includes `fetch` requests, external loaded media, and in some cases, even requests made by native modules.

Image: Gain insights in the network requests from your app.

> See the [Inspecting network traffic](/debugging/tools.md#inspecting-network-traffic) for alternative ways to inspect network requests.

### Inspecting memory

The **Memory** tab allows you to inspect the memory usage and take a heap snapshot of your app's JavaScript code.

Image: Inspect memory usage of your app's JavaScript code.

### Inspecting components

The **Components** tab allows you to inspect the React components in your app. You can view the props, and styles of each component by hovering that component in React Native DevTools. This is a great way to debug your app's UI and understand how your components are structured.

Image: Inspect a component in React Native DevTools.

### Profiling JavaScript performance

> Profiles are not yet symbolicated with sourcemaps, and [can only be used in debug builds](https://github.com/facebook/hermes/issues/760). These limitations will be addressed in upcoming releases.

The **Profiler** tab allows you to record and analyze the performance of your app's JavaScript. You can start recording, interact with your app, and stop recording to analyze the profile.

Image: React Native DevTools Profiler tab open to show insights on app's JavaScript performance.

> To profile the native runtime, use the tools included in Android Studio or Xcode.

### Rozenite

[**Rozenite**](https://www.rozenite.dev/) is a React Native DevTools plugin framework. It allows you to install plug-and-play integrations which get auto-discovered and appear as panels in React Native Devtools. You can also [create your own Rozenite plugin](https://www.rozenite.dev/docs/plugin-development/plugin-development) to integrate with custom or third party tools.

## Debugging with VS Code

> VS Code debugger integration is in [alpha](/more/release-statuses.md#alpha). For the most stable debugging experience, [use the React Native DevTools](/debugging/tools.md#debugging-with-react-native-devtools).

VS Code is a popular code editor, which has a built-in debugger. This debugger uses the same system as the React Native DevTools — the inspector protocol.

You can use this debugger with the [Expo Tools](https://github.com/expo/vscode-expo#readme) VS Code extension. This debugger allows you to set breakpoints, inspect variables, and execute code through the debug console.

Image: Debug your code while you write it.

To start debugging:

-   Connect your app
-   Open VS Code command palette (based on your computer, it's either Ctrl + Shift + P or Cmd ⌘ + Shift + P)
-   Run the **Expo: Debug ...** VS Code command.

This will attach VS Code to your running app.

Alternatively, if you want a fully-featured IDE setup in VS Code, you might want to check out the [Radon IDE](https://ide.swmansion.com/) extension (paid with a 30-day free trial). It turns your editor into a powerful environment designed specifically for React Native and Expo projects, with advanced debugging, a network inspector, router integration, and other built-in tools.

Image: Debugging code using Radon IDE.

## React Native Debugger

> The React Native Debugger requires Remote JS debugging, which has been deprecated since [React Native 0.73](https://reactnative.dev/docs/other-debugging-methods#remote-javascript-debugging-deprecated).

The React Native Debugger is a standalone app that wraps the React DevTools, Redux DevTools, and React Native DevTools. Unfortunately, it requires the [deprecated Remote JS debugging workflow](https://github.com/jhen0409/react-native-debugger/discussions/774) and is incompatible with Hermes.

If you are using Expo **SDK 50** or **above**, you can use the [Expo dev tools plugins](/debugging/devtools-plugins.md) equivalents to the React Native Debugger:

-   [React Native DevTools](/debugging/tools.md#debugging-with-react-native-devtools)
-   [Redux DevTools](/debugging/devtools-plugins.md#redux)

If you are using Expo SDK 49 and earlier, you can use the React Native Debugger. This section provides quick get started instructions. For in-depth information, check its [documentation](https://github.com/jhen0409/react-native-debugger#documentation).

You can install it via the [release page](https://github.com/jhen0409/react-native-debugger/releases), or if you're on macOS you can run:

```sh
brew install react-native-debugger
```

### Startup

After firing up React Native Debugger, you'll need to specify the port (shortcuts: Cmd ⌘ + T on macOS, Ctrl + T on Linux/Windows) to `8081`. After that, run your project with `npx expo start`, and select `Debug remote JS` from the Developer Menu. The debugger should automatically connect.

In the debugger console, you can see the Element tree, as well as the props, state, and children of whatever element you select. You also have the Chrome console on the right, and if you type `$r` in the console, you will see the breakdown of your selected element.

If you right-click anywhere in the React Native Debugger, you'll get some handy shortcuts to reload your JS, enable/disable the element inspector, network inspector, and to log and clear your `AsyncStorage` content.

### Inspecting network traffic

It's easy to use the React Native Debugger to debug your network request: right-click anywhere in the React Native Debugger and select `Enable Network Inspect`. This will enable the Network tab and allow you to inspect requests of `fetch` and `XMLHttpRequest`.

There are however [some limitations](https://github.com/jhen0409/react-native-debugger/blob/master/docs/network-inspect-of-chrome-devtools.md#limitations), so there are a few other alternatives, all of which require using a proxy:

-   [Charles Proxy](https://www.charlesproxy.com/documentation/configuration/browser-and-system-configuration/) (~$50 USD, our preferred tool)
-   [Proxyman](https://proxyman.io) (Free version available or $49 to $59 USD)
-   [mitmproxy](https://medium.com/@rotxed/how-to-debug-http-s-traffic-on-android-7fbe5d2a34#.hnhanhyoz)
-   [Fiddler](https://www.telerik.com/fiddler)

## Debugging production apps

In reality, apps often ship with bugs. Implementing a crash and bug reporting system can help you get real-time insights of your production apps. See [Using error reporting services](/debugging/runtime-issues.md#using-error-reporting-services) for more details.
