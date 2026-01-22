import React from "react";

type PanelProps = {
	children?: React.ReactNode;
	className?: string;
};

export default function Panel({ children, className = "" }: PanelProps) {
	return <div className={["panel", className].filter(Boolean).join(" ")}>{children}</div>;
}