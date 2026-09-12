import { queueAction } from './offlineQueue';
import { supabase } from './supabaseClient';
import type { Admission } from './types';

interface RegisterAdmissionParams {
  outletId: string;
  patientName: string;
  wardBed?: string;
  referringDoctor?: string;
  createdBy: string;
}

export async function registerAdmission(params: RegisterAdmissionParams) {
  return queueAction('admissions', 'insert', {
    outlet_id: params.outletId,
    patient_name: params.patientName,
    ward_bed: params.wardBed ?? null,
    referring_doctor: params.referringDoctor ?? null,
    created_by: params.createdBy,
  });
}

// Server-side trigger (check_discharge_clearance) independently blocks
// this if any linked bill still has balance_due > 0.
//
// Deliberately a direct, awaited call rather than routed through the
// offline queue: discharge is an occasional, deliberate counter
// action (not a high-frequency transaction like billing), and a
// rejection here (e.g. outstanding balance) needs to surface
// immediately and inline — queuing it would mean a business-rule
// rejection only appears minutes later in a background banner, with
// the button visually doing nothing in between. Requires the device
// to be online, same as opening/closing a shift.
export async function dischargePatient(admissionId: string) {
  const { error } = await supabase.rpc('discharge_cash_patient', { p_admission_id: admissionId });
  if (error) throw error;
}

export async function getActiveAdmissions(outletId: string): Promise<Admission[]> {
  const { data, error } = await supabase
    .from('admissions')
    .select('*')
    .eq('outlet_id', outletId)
    .eq('status', 'admitted')
    .order('admitted_at', { ascending: false });
  if (error) throw error;
  return data as Admission[];
}
