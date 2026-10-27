import {digest} from './auth.mjs';
import {AIGC_PARAGRAPH_VERSION} from '../dist/reports/aigc-partitions.mjs';
export const aigcInputHash=(text,version)=>digest((version===AIGC_PARAGRAPH_VERSION?'aigc-paragraph-v2\0':'aigc-v1\0')+text);
