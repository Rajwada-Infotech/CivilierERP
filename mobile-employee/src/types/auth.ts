/** The signed-in employee login (an Employee Portal account; role "Employee Portal"). */
export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string;
  initials: string;
}

export interface LoginResponse {
  success: boolean;
  token: string;
  user: { id: number; name: string; email: string; role: string };
}
