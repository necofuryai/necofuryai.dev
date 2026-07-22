export interface ExperienceItem {
	period: string;
	title: string;
	description: string;
}

export const experienceItems = [
	{
		period: "2026–Now",
		title: "Independent Product Builder",
		description:
			"Designed, shipped, and now operate an iOS productivity product end to end, from its Go API and Flutter client to cloud infrastructure, CI/CD, observability, security, and monetization.",
	},
	{
		period: "2025–Now",
		title: "Cloud Infrastructure & CI/CD Lead",
		description:
			"Lead cloud infrastructure and software delivery for an internal engineering product. Migrated live infrastructure to Terraform and introduced keyless CI/CD, automated rollback, monitoring, and operational runbooks.",
	},
	{
		period: "2024–2025",
		title: "Embedded Data Systems",
		description:
			"Ported a Python-validated estimation algorithm to a constrained embedded runtime while preserving its accuracy, and designed its testing and data-output workflows.",
	},
	{
		period: "2022–2024",
		title: "Data Platform R&D",
		description:
			"Worked across requirements, backend, frontend, AWS, and Terraform on a cross-organization data platform, shaping its first viable release and improving delivery across teams.",
	},
	{
		period: "2021–2022",
		title: "Security Operations",
		description:
			"Operated a security monitoring platform, automated repeatable maintenance with Ansible, and strengthened log onboarding and upgrade procedures.",
	},
	{
		period: "2018–2021",
		title: "Enterprise Systems & Automation",
		description:
			"Extended open-source internal systems and automated operational workflows, then led a secure file-exchange platform. Redesigned approval and detection processes to reduce manual review effort by roughly one-third without weakening controls.",
	},
] satisfies ExperienceItem[];
