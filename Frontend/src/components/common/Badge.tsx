import React from "react";

type BadgeProps = {
	children?: React.ReactNode;
	variant?: "default" | "info" | "success" | "warning";
	className?: string;
};

export default function Badge({
	children,
	variant = "default",
	className = "",
}: BadgeProps) {
	return (
		<span className={["badge", `badge-${variant}`, className].filter(Boolean).join(" ")}>
			{children}
		</span>
	);
}