import type { SimConfig } from '../types'
export const saveSessionConfig = async (config: SimConfig): Promise<SimConfig> => ({ ...config })
