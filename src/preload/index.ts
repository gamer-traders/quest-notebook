import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('quest', {});
