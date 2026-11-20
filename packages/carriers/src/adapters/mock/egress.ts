/**
 * The Mock's egress table (ADR-0010 am. 11 item 6): empty in both environments, because the Mock makes no network call.
 * An allow-list rule derived from it is therefore never created for the Mock.
 */
import { type CarrierEgress, defineCarrierEgress } from '../../egress.js';
import { MOCK_CARRIER_CODE } from './constants.js';

export const EGRESS: CarrierEgress = defineCarrierEgress(MOCK_CARRIER_CODE, { sandbox: [], production: [] });
