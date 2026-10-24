# @stagefright5/jenkins-cli

## 0.1.1

### Patch Changes

- Extract the Jenkins implementation into the independent `@stagefright5/jenkins-cli` npm package with the `jenkins` executable and a package-identifying `--version` command. The CLI has no pi runtime dependency and preserves existing profiles, configuration locations, credential providers, build safeguards, and artifact protections.

  The Jenkins operations skill now invokes `jenkins` on PATH and checks for a supported CLI version. Install `@stagefright5/jenkins-cli@0.1` separately; the skill no longer bundles scripts. Replace old skill-relative script invocations with `jenkins`, `jenkins configure`, `jenkins inspect JOB`, or `jenkins build JOB`.
