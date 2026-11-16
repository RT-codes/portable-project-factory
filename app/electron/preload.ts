import { contextBridge, ipcRenderer } from 'electron'

// The only bridge between the window and the main process: one call that names a method of `Api`
// (shared/api.ts), and one subscription for the few things the main process announces.
contextBridge.exposeInMainWorld('factoryApp', {
  platform: process.platform,
  invoke: (method: string, args: unknown[]) => ipcRenderer.invoke('api', method, args),
  onEvent: (listener: (name: string) => void) => {
    const handler = (_: unknown, name: string) => listener(name)
    ipcRenderer.on('event', handler)
    return () => ipcRenderer.removeListener('event', handler)
  },
})
