# Third-party notices

Parts of the Weixin wire protocol, QR state machine, message payload shapes,
and AES-128-ECB CDN behavior in this package were reimplemented from:

- Package: `@tencent-weixin/openclaw-weixin`
- Version: `2.4.6`
- Downloaded from: npm registry
- npm integrity:
  `sha512-qw9k3PLTiMWGNjjsknHgcTManH1w4j+Ji1ArWIaYLKCq3aFRsVwcqnPi127bvOoVMJGW4dbyJ8NECEMgoO+iRw==`
- Tarball SHA-512:
  `ab0f64dcf2d388c5863638ec9271e071331a9c7d70e23f898b502b5886982ca0aadda151b15c1caa73e2d76edbbcea15309196e1d6f227c344084320a0efa247`

The OpenClaw plugin entry, runtime integration, account files, pairing store,
command handling, reply dispatcher, logging, and cursor persistence were not
copied. Minke supplies its own host interface and state ownership.

Tencent is pleased to support the open source community by making
openclaw-weixin available.

Copyright (C) 2026 Tencent. All rights reserved.

openclaw-weixin is licensed under the MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
