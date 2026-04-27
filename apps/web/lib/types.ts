export type UserRole =
  | "Customer"
  | "WarehouseProvider"
  | "ServiceProvider"
  | "Employer"
  | "Worker"
  | "TruckingCompany"
  | "Driver"
  | "GateStaff"
  | "Admin"
  | "SuperAdmin";

export type CompanyType =
  | "Customer"
  | "WarehouseProvider"
  | "ServiceProvider"
  | "Employer"
  | "TruckingCompany";

export interface Profile {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
}

export interface CompanyMembership {
  company_id: string;
  user_id: string;
  role: string;
  company_name: string;
  company_type: CompanyType;
  company_status: string;
}
