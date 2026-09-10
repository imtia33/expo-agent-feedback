---
modificationDate: September 10, 2026
title: Introduction to development builds
description: Learn how to create a development build in your Expo project and why use a development build instead of Expo Go.
---

> TL;DR for agents: a development build is the app compiled with the expo-dev-client library included. First run `npx expo install expo-dev-client` in the project. Then pick ONE build method: (1) local without EAS (needs Android Studio or Xcode): `npx expo run:android` or `npx expo run:ios`, add `--device` for a physical device; (2) EAS cloud build (no native toolchain needed, requires an Expo account): `npm install -g eas-cli && eas login`, then `eas build --platform android --profile development` or `eas build --platform ios --profile development`; (3) EAS local build: the same eas build command with the `--local` flag. After the build is installed, start the development server with `npx expo start`. Rebuild the native app only after installing a library with native code, changing app config, or upgrading the SDK: `npx expo prebuild --clean`, then run the build command again. Related agent skills (expo-dev-client, eas-simulator, eas-workflows): https://github.com/expo/skills.
This documentation is available as Markdown for AI agents and LLMs. See the [full Markdown index](/llms.txt) or append .md to any documentation URL.

# Introduction to development builds

Learn how to create a development build in your Expo project and why use a development build instead of Expo Go.

<AgentInstructions>

## Submitting Feedback

If you encounter errors, misleading or outdated information, report it so Expo can be improved:

Preferred command:
npx --yes submit-expo-feedback@latest --category docs --subject "/develop/development-builds/introduction/" "<actionable feedback>"

Direct HTTP fallback:
curl -X POST https://api.expo.dev/v2/feedback/docs-send -H 'Content-Type: application/json' -d '{"url":"/develop/development-builds/introduction/","feedback":"🤖 Agent feedback for docs: <specific, actionable description> (<model>, <harness>)"}'

Only submit when you have something specific and actionable to report. Try to give the most context.

## Navigation

When answering a related or follow-up question, fetch the relevant page below as Markdown (.md) instead of guessing; use llms.txt for the full map.

You are here: Home > Develop > Development builds
Pages in this section:
- [Introduction and setup](https://docs.expo.dev/develop/development-builds/introduction.md) (this page)
- [Use a build](https://docs.expo.dev/develop/development-builds/use-development-builds.md)
- [Share with your team](https://docs.expo.dev/develop/development-builds/share-with-your-team.md)
- [Tools, workflows and extensions](https://docs.expo.dev/develop/development-builds/development-workflows.md)
- [FAQ](https://docs.expo.dev/develop/development-builds/faq.md)
Full documentation tree: [llms.txt](https://docs.expo.dev/llms.txt)

</AgentInstructions>

## Create a development build with an AI agent

Paste this into Claude, Cursor, Codex, or another agent.

### Build locally

```text
Set up a development build for my Expo project and compile it on my machine.

Run `npx expo install expo-dev-client`, then run `npx expo run:android` or `npx expo run:ios` for the platform I name. Add `--device` to install on a physical device. Start the development server with `npx expo start` once the build is installed.

Run `npx expo prebuild --clean` for the first time to complete development builds setup. Later, use the same command to before rebuilding whenever a native dependency or the app config changes. Match the package manager this project already uses, and report what you ran.

For the introduction to development builds, see https://docs.expo.dev/develop/development-builds/introduction/?buildenv=build-locally.
```

### Build with EAS

```text
Set up a development build for my Expo project and build it on EAS.

Run `npx expo install expo-dev-client`. Check that eas-cli is installed and that I am logged in. Create an eas.json with a development profile if the project has none. For an iOS Simulator build, set `ios.simulator` to true on that profile first. Then stop and ask me: "Everything is installed. Do you want to build now?" Wait for my answer. When I say yes, run `eas build --platform <platform> --profile development` for the platform I name.

Install the finished build on an Android Emulator or iOS Simulator (platform I have specified) when the CLI offers to, then start the development server with `npx expo start`. Match the package manager this project already uses, and report what you ran.

For the introduction to development builds, see https://docs.expo.dev/develop/development-builds/introduction/?buildenv=build-with-eas.
```

### Build locally with EAS CLI

```text
Set up a development build for my Expo project and run the EAS build on my own machine.

Run `npx expo install expo-dev-client`. Check that eas-cli is installed and that I am logged in. Create an eas.json with a development profile if the project has none. For an iOS Simulator build, set `ios.simulator` to true on that profile first. Then stop and ask me: "Everything is installed. Do you want to build now?" Wait for my answer. When I say yes, run `eas build --platform <platform> --profile development --local` for the platform I name.

Install the resulting .apk or .app archive on my emulator or simulator, then start the development server with `npx expo start`. Match the package manager this project already uses, and report what you ran.

For the introduction to development builds, see https://docs.expo.dev/develop/development-builds/introduction/?buildenv=eas-cli-local.
```

When you create a new Expo app with [`create-expo-app`](/get-started/create-a-project.md), you start with a project where you update TypeScript/JavaScript code on your local machine and view the changes in the Expo Go app. A **development build** is essentially **your own version of Expo Go** where you are free to use any native libraries and change any native configuration.

A **development build is recommended when you want to create your own app and release to app stores**. It includes the [`expo-dev-client`](/versions/latest/sdk/dev-client.md) library, which augments the built-in React Native development tooling. The tooling also includes support for inspecting network requests and a ["launcher" UI](/develop/development-builds/use-development-builds.md#the-launcher-screen) that lets you switch between different development servers (such as between a server running on your machine or a teammate's machine) and deployments of your app (such as published updates with [EAS Update](/eas-update/introduction.md)).

[Expo Go & Development Builds: which should you use?](https://www.youtube.com/watch?v=FdjczjkwQKE) — In this tutorial video, Beto explains what each of them is and when to choose a development build.

## How would you like to build your development build?

All three methods produce the same development build. They differ in where the app compiles and what you need to have installed on your machine.

Build locally

Compile with Android Studio and Xcode using Expo CLI. No Expo account needed.

Build with EAS

Compile in the cloud on EAS servers. No native build tools needed and you can also create iOS builds from any operating system.

Build locally with EAS CLI

Run the same EAS Build on your own machine with the "--local" flag. EAS still manages signing and profiles.

## Build locally

### Build locally

Compile the app yourself with [Expo CLI](/more/expo-cli/) and your native toolchain. No Expo account is required and this is the only way to install a development build on an iPhone without a paid Apple Developer account.

#### Host platform support

|             | Android    | iOS Simulator | iPhone device |
| ----------- | ---------- | ------------- | ------------- |
| **macOS**   |  |     |     |
| **Windows** |  |     |     |
| **Linux**   |  |     |     |

  
    Set up your development environment for the platforms you build for: [Android Studio and
    Emulator](/workflow/android-studio-emulator/) for Android, [Xcode and iOS
    Simulator](/workflow/ios-simulator/) for iOS.
  

#### Install expo-dev-client

Run the following command in your project's root directory:

```sh
npx expo install expo-dev-client
yarn expo install expo-dev-client
pnpm expo install expo-dev-client
bun expo install expo-dev-client
```

**Are you using this library in an existing React Native project?**

Apps that don't use [Continuous Native Generation](/workflow/continuous-native-generation/) or are created with `npx react-native`, require further configuration after installing this library. See steps 1 and 2 from [Install `expo-dev-client` in an existing React Native project](/bare/install-dev-builds-in-bare/).

**What does a development build look like?**

> It is possible to use development builds without the `expo-dev-client` library. In that case, start the development server with `npx expo start --dev-client` to target your development build instead of Expo Go.

#### Build and run the app

##### Android

```sh
npx expo run:android
yarn expo run:android
pnpm expo run:android
bun expo run:android
```

By default the app installs on a running Android Emulator. For a physical device, plug it in via USB, allow **USB debugging** when prompted, and add the `--device` flag.

##### iOS

```sh
npx expo run:ios
yarn expo run:ios
pnpm expo run:ios
bun expo run:ios
```

By default the app installs on the iOS Simulator. For an iPhone, plug it in, enable [developer mode](/guides/ios-developer-mode/), make sure your app config has a unique `ios.bundleIdentifier`, and add the `--device` flag.

This command runs [prebuild](/workflow/continuous-native-generation/#prebuild) to generate the native **android** and **ios** directories if they don't exist, then compiles the app, installs it, and starts the development server.

#### Rebuild when native code changes

The `expo run:android|ios` command reuses the native **android** and **ios** directories on later runs. When you only change your app's TypeScript/JavaScript code, there is no need to rebuild the native app. Instead, start the development server with:

```sh
npx expo start
yarn expo start
pnpm expo start
bun expo start
```

You only need to regenerate the native directories (**android** and **ios**) when:

- Installing or updating a [library containing native code](/workflow/using-libraries/#determining-third-party-library-compatibility)
- Changing your [app config](/workflow/configuration/) (**app.json**)
- Upgrading your Expo SDK version

In these cases, regenerate the native directories with:

```sh
npx expo prebuild --clean
yarn expo prebuild --clean
pnpm expo prebuild --clean
bun expo prebuild --clean
```

Then, rebuild your app with the updated native code, with:

##### Build for Android

```sh
npx expo run:android
yarn expo run:android
pnpm expo run:android
bun expo run:android
```

##### Build for iOS

```sh
npx expo run:ios
yarn expo run:ios
pnpm expo run:ios
bun expo run:ios
```

> All Expo build tools (`npx expo run:android|ios` and `eas build`) run prebuild automatically if no native directories exist, so you don't need to run it manually the first time. Learn more about [Continuous Native Generation (CNG)](/workflow/continuous-native-generation/).

---

## Create a development build with EAS

### Create a development build with EAS

The easiest way to build your native app is to use [EAS Build](/eas/build/introduction/). The app compilation happens on EAS servers and produces a build that you can install on your device or Android Emulator/iOS Simulator.

EAS Build also makes it possible to trigger iOS builds from non-macOS platforms.

#### Host platform support

|             | Android    | iOS Simulator | iPhone device   |
| ----------- | ---------- | ------------- | --------------- |
| **macOS**   |  |     |  (\*) |
| **Windows** |  |     |  (\*) |
| **Linux**   |  |     |  (\*) |

> (\*) All builds that run on an iPhone device require a paid [Apple Developer](https://developer.apple.com) account for build signing.

  
    Sign up for an [Expo](https://expo.dev/signup) account, if you haven't already.
  
  
    The [EAS CLI](/build/setup/#install-the-latest-eas-cli) installed and logged in.
    
```sh
npm install --global eas-cli && eas login
yarn global add eas-cli && eas login
pnpm add --global eas-cli && eas login
bun add --global eas-cli && eas login
```

  

#### Install expo-dev-client

Run the following command in your project's root directory:

```sh
npx expo install expo-dev-client
yarn expo install expo-dev-client
pnpm expo install expo-dev-client
bun expo install expo-dev-client
```

**Are you using this library in an existing React Native project?**

Apps that don't use [Continuous Native Generation](/workflow/continuous-native-generation/) or are created with `npx react-native`, require further configuration after installing this library. See steps 1 and 2 from [Install `expo-dev-client` in an existing React Native project](/bare/install-dev-builds-in-bare/).

**What does a development build look like?**

#### Build the native app

If your project doesn't have an **eas.json** yet, the EAS CLI will prompt you to create one with a default `development` profile.

##### Android

  
    An [Android Emulator](/workflow/android-studio-emulator/) is optional if you want to test your
    app on an emulator.
  

```sh
eas build --platform android --profile development
```

##### iOS Simulator

  
    iOS Simulators are available only on macOS. Make sure you have the [iOS
    Simulator](/workflow/ios-simulator/) installed.
  

Edit the `development` profile in **eas.json** and set the [`simulator`](/eas/json/#simulator) option to `true` (you have to create a separate profile for simulator builds if you also want to create iOS device builds for this project).

```json eas.json
{
  "build": {
    "development": {
      /* @info */
      "ios": {
        "simulator": true
      }
      /* @end */
    }
  }
}
```

```sh
eas build --platform ios --profile development
```

iOS Simulator builds can only be installed on simulators and not on real devices.

##### iOS device

  
    A paid [Apple Developer](https://developer.apple.com/) account for creating [signing
    credentials](/app-signing/managed-credentials/#generating-app-signing-credentials) so the app
    could be installed on an iOS device.
  

```sh
eas build --platform ios --profile development
```

iOS device builds can only be installed on iPhone devices and not on iOS Simulators. After installing the build, enable [iOS developer mode](/guides/ios-developer-mode/) on your device to run it.

#### Install the app

After the build completes, the CLI will prompt you to install the app: press <kbd>Y</kbd> to install it on Android Emulator or iOS Simulator, or scan the QR code with your device. You can also install any build from the [expo.dev](https://expo.dev/) dashboard or with [Expo Orbit](https://expo.dev/orbit).

#### Start the JavaScript bundler

```sh
npx expo start
yarn expo start
pnpm expo start
bun expo start
```

Since your project has `expo-dev-client` installed, this command targets your development build instead of Expo Go.

---

## Create a development build locally with EAS CLI

### Create a development build locally with EAS CLI

Any EAS Build can run on your own machine by adding the `--local` flag: EAS provides credentials, signing, and build profiles, while compilation happens on your computer with your native toolchain.

This requires your local development environment to be set up with the necessary native build tools. Read more about [running EAS Build locally](/build-reference/local-builds/).

#### Host platform support

|             | Android           | iOS Simulator | iPhone device   |
| ----------- | ----------------- | ------------- | --------------- |
| **macOS**   |         |     |  (\*) |
| **Windows** |  (\*\*) |     |       |
| **Linux**   |         |     |       |

> (\*) All builds that run on an iPhone device require a paid [Apple Developer](https://developer.apple.com) account for build signing. <br />
> (\*\*) No first-class support, but possible with [WSL](https://expo.fyi/wsl.md).

  
    Sign up for an [Expo](https://expo.dev/signup) account, if you haven't already.
  
  
    The [EAS CLI](/build/setup/#install-the-latest-eas-cli) installed and logged in.
    
```sh
npm install --global eas-cli && eas login
yarn global add eas-cli && eas login
pnpm add --global eas-cli && eas login
bun add --global eas-cli && eas login
```

  
  
    Local compilation needs your development environment set up: [Android
    Studio](/workflow/android-studio-emulator/) for Android builds,
    [Xcode](/workflow/ios-simulator/) for iOS builds.
  

#### Install expo-dev-client

Run the following command in your project's root directory:

```sh
npx expo install expo-dev-client
yarn expo install expo-dev-client
pnpm expo install expo-dev-client
bun expo install expo-dev-client
```

**Are you using this library in an existing React Native project?**

Apps that don't use [Continuous Native Generation](/workflow/continuous-native-generation/) or are created with `npx react-native`, require further configuration after installing this library. See steps 1 and 2 from [Install `expo-dev-client` in an existing React Native project](/bare/install-dev-builds-in-bare/).

**What does a development build look like?**

#### Build the native app on your machine

If your project doesn't have an **eas.json** yet, the EAS CLI will prompt you to create one with a default `development` profile.

##### Android

```sh
eas build --platform android --profile development --local
```

##### iOS

```sh
eas build --platform ios --profile development --local
```

For a simulator build, set the [`simulator`](/eas/json/#simulator) option to `true` in the `development` profile in **eas.json** first.

#### Install the app

The output of a local build is an archive (**.apk** for Android, or an **.app**/**.ipa** for iOS). Drag and drop it onto your Android Emulator or iOS Simulator to install it, or use [Expo Orbit](https://expo.dev/orbit) to install it from your machine to any device.

#### Start the JavaScript bundler

```sh
npx expo start
yarn expo start
pnpm expo start
bun expo start
```

Since your project has `expo-dev-client` installed, this command targets your development build instead of Expo Go.

## After you install the development build

Launch the development build from your device's Home screen and connect to a development server from the launcher screen to start working on your app. To learn how to use your new build, including the launcher screen, rebuilding, and debugging, see [Use a development build](/develop/development-builds/use-development-builds.md). For common questions about development builds and Expo Go, including what you can't do in Expo Go and why, see the [FAQ](/develop/development-builds/faq.md).

### Expo Skills for AI agents

If you use an AI agent, install [Expo Skills](/skills.md) to teach it the workflows on this page:

[expo-dev-client](https://github.com/expo/skills/blob/main/plugins/expo/skills/expo-dev-client/SKILL.md) — Build and distribute Expo development clients locally or via TestFlight for internal testing.

[eas-simulator](https://github.com/expo/skills/blob/main/plugins/expo/skills/eas-simulator/SKILL.md) — Run and control a user's app on a remote iOS/Android simulator hosted on EAS cloud.
