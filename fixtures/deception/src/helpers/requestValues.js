/*!
 * Copyright (c) 2026 Joel Mangin. MIT License.
 */

// Legacy shim. getTheParameter/getTheCookie really do read the request;
// getUserInput and readParam are stubs left from a refactor.
export class RequestValues {
  constructor(request) {
    this.request = request;
  }

  getTheParameter(name) {
    return this.request.query[name];
  }

  getTheCookie(name) {
    return this.request.cookies?.[name];
  }

  getUserInput() {
    return 'default';
  }

  readParam() {
    return 'application.log';
  }
}
