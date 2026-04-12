import Image from "next/image";
import { getInitials } from "@/lib/utils";

type AvatarProps = {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
};

const sizes = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg"
};

export function Avatar({ name, src, size = "md" }: AvatarProps) {
  return (
    <div className={`${sizes[size]} relative shrink-0 overflow-hidden rounded-lg bg-moss/10 text-moss dark:bg-white/10 dark:text-white`}>
      {src ? (
        <Image src={src} alt={name} fill sizes="64px" className="object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center font-semibold">{getInitials(name || "C")}</div>
      )}
    </div>
  );
}
