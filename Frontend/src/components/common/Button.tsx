import React from "react";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: string;
};

export default function Button({ children, variant, className = "", ...rest }: ButtonProps) {
	const cls = ["btn", variant ? `btn-${variant}` : "", className].filter(Boolean).join(" ");
	return (
		<button {...rest} className={cls}>
			{children}
		</button>
	);
}