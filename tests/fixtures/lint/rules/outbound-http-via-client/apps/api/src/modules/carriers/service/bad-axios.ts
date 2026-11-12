import axios from 'axios';

export const load = (url: string): Promise<unknown> => axios.get(url);
