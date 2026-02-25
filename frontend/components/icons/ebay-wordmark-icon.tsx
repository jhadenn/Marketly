import * as React from "react";
import { IconProps } from "@/types";

const EbayWordmarkIcon = ({ size = 20, ...props }: IconProps) => (
  <svg
    height={size}
    viewBox="0 0 80 32"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <text
      x="0"
      y="16"
      dominantBaseline="middle"
      style={{
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: "-0.02em",
      }}
    >
      eBay
    </text>
  </svg>
);

export default EbayWordmarkIcon;

