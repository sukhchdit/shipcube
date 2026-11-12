import axios from 'axios';

export const sessionClient = axios.create({ withCredentials: true });
