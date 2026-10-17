# End-to-End (E2E) testing

> [!IMPORTANT]
> Only use the setup guidelines in this file if there is no existing E2E testing framework configured in the workspace, or if the user has explicitly requested to change or set up E2E testing.

## Setting up and running E2E tests

Add supported E2E frameworks to the project using `ng add`:

- **Playwright:**
  ```shell
  ng add playwright-ng-schematics
  ```
- **Cypress:**
  ```shell
  ng add @cypress/schematic
  ```
- **Nightwatch:**
  ```shell
  ng add @nightwatch/schematics
  ```
- **WebdriverIO:**
  ```shell
  ng add @wdio/schematics
  ```
- **Puppeteer:**
  ```shell
  ng add @puppeteer/ng-schematics
  ```

Run E2E tests:

```shell
ng e2e [project] [options]
```

## Custom & enterprise testing tools

For custom enterprise runners (e.g., Katalon Studio, TestCafe, Selenium), define execution commands in `package.json` scripts.
