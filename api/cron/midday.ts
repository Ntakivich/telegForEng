import { handleCron } from '../../src/runtime.js';

export const GET = (request: Request) => handleCron(request, 'midday');
