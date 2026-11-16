// The employee's profile picture (the photo on their Employee Master record), or their initials when there is none.
import { useQuery } from "@tanstack/react-query";
import { getPortalProfile } from "@/api/employeePortalApi";

export function useProfilePhoto() {
  const { data } = useQuery({ queryKey: ["ep-profile"], queryFn: getPortalProfile, staleTime: 5 * 60_000 });
  return { photo: data?.Photo || null, name: data?.EmployeeName };
}

export function EmployeeAvatar({ initials, size = 32, className = "" }: { initials?: string; size?: number; className?: string }) {
  const { photo, name } = useProfilePhoto();
  const box = { width: size, height: size, fontSize: Math.max(10, Math.round(size / 3)) };
  return photo ? (
    <img src={photo} alt={name ? `${name}'s photo` : "Profile photo"} style={box} className={`rounded-full object-cover shrink-0 ${className}`} />
  ) : (
    <span style={box} className={`rounded-full flex items-center justify-center font-bold text-primary-foreground gradient-accent shrink-0 ${className}`}>{initials || "E"}</span>
  );
}
