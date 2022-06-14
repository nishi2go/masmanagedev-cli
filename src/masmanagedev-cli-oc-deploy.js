#! /usr/bin/env node

/*
 * Copyright (c) 2021-present, Yasutaka Nishimura.
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const cli = require("./lib/cli");
const env = require("./lib/env");
const fs = require('fs-extra');
const log = require("./lib/logger");
const oc = require("./lib/oc");
const templates = require("./lib/templates");
const path = require('path');

var schema = {
  _version: "0.0.1",
  _description: "Customization archive publishment support",
  properties: {
    buildName: {
      _prompt: false,
      required: true,
      description: "Customization archive build config name.",
      _cli: "build-name",
      default: "customization-archive",
    },
    instance: {
      required: true,
      description: "Maximo Application Suite instance name.",
      _cli: "instance",
    },
    workspace: {
      required: true,
      description: "Maximo Manage Workspace name.",
      _cli: "workspace",
    },
    archive: {
      _prompt: false,
      required: false,
      description: "Customization archive file name. If you do not specify the name, the latest archive file is automatically selected.",
      _cli: "archive",
    },
    dir: {
      _prompt: false,
      required: false,
      description: "The directory including Customization archive files.",
      default: "dist/.",
      _cli: "dir",
    },
    mode: {
      required: false,
      _prompt: false,
      description: 'Select a mode to list customization archives under the dir. "latest" is selected the latest file name. "all" is listed all zip files under the dir. "all" is supported in MAS 8.7 or later.',
      _cli: "mode",
      default: "latest",
      pattern: /^(latest|all)$/,
      message: "mode must be a desinated string",
    },
    expose: {
      _prompt: false,
      description: "Expose the created HTTP service from the build?",
      required: false,
      _cli: 'expose',
      _yesno: 'y',
    }
  },
};

cli.process(schema, process.argv, deploy);

function deploy(result) {
  if (!oc.exists()) {
    log.error(`Could not find oc cli, is OpenShift installed? Aborting...`);
    return;
  }

  if (!oc.loggedIn()) {
    log.error(
      `Need to login to OpenShift. Use ''oc login <openshift URL> -u <openshift admin username> -p <openshift admin password>' Aborting...`
    );
    return;
  }

  const namespace = `mas-${result.instance.trim()}-manage`;

  if (!oc.setNamespace(namespace)) {
    log.error(`Manage namespece ${namespace} does not exist. Aborting...`);
    return;
  }

  // Ensure zips in dist
  const buildDir = result.dir;

  const archiveList = [];
  if (result.archive) {
    if (!fs.existsSync(path.join(buildDir, result.archive))) {
      log.error(`Could not find any customization archive. Please specify a valid archive name.`);
      return;
    }
    archiveList.push(result.archive);
  } else if (result.mode === "all") {
    const _archiveList = oc.getAllArchiveNames(buildDir);
    if (_archiveList && _archiveList.length === 0) {
      log.error(`Could not find any customization archive. Please run the create zip command.`);
      return;
    }
    archiveList.push(..._archiveList);
  } else {
    const archive = oc.getLatestArchiveName(buildDir);
    if (!archive) {
      log.error(`Could not find any customization archive. Please run the create zip command.`);
      return;
    }
    archiveList.push(archive);
  }

  const buildName = result.buildName.trim();
  // Check and make a build config
  // Get full path for the dockerfile
  const templatePath = templates.resolveName("publisher/Dockerfile");
  if (!oc.newBuild(buildName, templatePath)) {
    log.error(`Could not make a new build config: ${buildName}`);
    return;
  }

  // Run the build
  if (!oc.startBuild(buildName, buildDir)) {
    log.error(`Could not build: ${buildName}`);
    return;
  }

  // Check and make an app
  if (!oc.newApp(buildName)) {
    log.error(`Could not make a new app: ${buildName}`);
    return;
  }

  if (!oc.addNetworkPolicy(buildName, "publisher/NetworkPolicy.yml.in", "tmpnp.yml")) {
    log.error(`Could not upload a network policy: ${buildName}`);
    return;
  }

  // Check and make a route for the archive
  if (env.bool(result.expose) && !oc.expose(buildName)) {
    log.error(`Could not expose a service: ${buildName}`);
    return;
  }

  const hostname = oc.getServiceHostName(buildName.trim());
  const url = `http://${hostname}:8080/`;
  log.info(`Customization Archive URL: ${url}`);
  log.info(`Archive list:`);
  archiveList.forEach(archive => log.info(` - ${url}${archive}`));
  const manageWorkSpace = `${result.instance.trim()}-${result.workspace.trim()}`;
  if (archiveList.length > 1) {
    const customizationList = {
      customizationList:
        archiveList.map(archive => {
          const item = {
            customizationArchiveName: archive.slice(0, archive.length - 4),
            customizationArchiveUrl: `${url}${archive}`
          };
          return item;
        })
    };
    // Update the deployment config
    if (!oc.updateCustomizationListConfig(manageWorkSpace, customizationList)) {
      log.error(`Could not update the customization archive URL: ${url}`);
      return;
    }
  } else {
    const archiveUrl = `${url}${archiveList[0]}`;
    // Update the deployment config
    if (!oc.updateCustomizationArchiveConfig(manageWorkSpace, archiveUrl)) {
      log.error(`Could not update the customization archive URL: ${url}`);
      return;
    }
  }
}
