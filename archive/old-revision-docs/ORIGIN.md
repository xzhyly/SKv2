# Origin of this archive

This directory holds documentation from a separate, earlier open-source
project that this codebase was originally started from, then replaced. It is
not documentation of an earlier revision of Sining Kamay itself.

## What Phase 1 (dead-code deletion) removed

- `js/main.js`, `js/dist/build.js`, `package.json` — commit `bb7468f`
- `camera_test.html`, `gesture_test.html`, `speech_test.html` — commit `ddc741c`
- `css/animate.css` — commit `3c3147a`
- `preload.html` — commit `cc1ff23`
- `scratch/unpkg_dist.html`, `README (1).md`, `(1).gitignore.txt`, and a
  stray untracked shell-redirect file — commit `bdf7d51`

## Evidence of separate origin

`README (1).md`, deleted in commit `bdf7d51`, identified the deleted
`js/main.js`, `js/dist/build.js`, and `package.json` as belonging to a
different project, not an earlier revision of this one. Quoted verbatim from
that file before deletion:

> # Sign-Language-Translator

> The Sign Language Translator is my final project for Grade 12 Computer
> Science and the [PoweredByTF 2.0 Challenge](https://tensorflow.devpost.com/).

This matches the deleted code: `package.json`'s browserify/babel/deeplearn
toolchain, `js/main.js`'s deeplearn-era API usage, and the `js/dist/build.js`
browserify bundle. `(1).gitignore.txt`'s `node_modules`/`package-lock.json`/
`yarn.lock` rules belong to the same project.

## Current system, for contrast

The live Sining Kamay system uses MediaPipe Hands and TensorFlow.js for
on-device inference, loaded via `<script src>` with no build step. The
deleted code used deeplearn.js and a browserify/babel build pipeline.

## Recovery

Everything deleted in this phase is recoverable at the `baseline` git tag,
which points at the commit immediately before Phase 1 began.
