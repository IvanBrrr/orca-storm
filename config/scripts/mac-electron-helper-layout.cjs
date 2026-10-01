const { existsSync, renameSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

const HELPER_SUFFIXES = ['', ' (GPU)', ' (Plugin)', ' (Renderer)']

function restoreMacElectronHelperLayout(appBundlePath, productName) {
  const frameworksPath = join(appBundlePath, 'Contents', 'Frameworks')
  for (const suffix of HELPER_SUFFIXES) {
    const packagedName = `${productName} Helper${suffix}`
    const electronName = `Electron Helper${suffix}`
    const packagedApp = join(frameworksPath, `${packagedName}.app`)
    const electronApp = join(frameworksPath, `${electronName}.app`)
    if (!existsSync(packagedApp) || existsSync(electronApp)) {
      throw new Error(`Unexpected macOS Electron helper layout: ${packagedApp}`)
    }

    const packagedExecutable = join(packagedApp, 'Contents', 'MacOS', packagedName)
    if (!existsSync(packagedExecutable)) {
      throw new Error(`Missing macOS Electron helper executable: ${packagedExecutable}`)
    }
    renameSync(packagedExecutable, join(packagedApp, 'Contents', 'MacOS', electronName))
    execFileSync('/usr/libexec/PlistBuddy', [
      '-c',
      `Set :CFBundleExecutable ${electronName}`,
      join(packagedApp, 'Contents', 'Info.plist')
    ])
    renameSync(packagedApp, electronApp)
  }
}

module.exports = { restoreMacElectronHelperLayout }
