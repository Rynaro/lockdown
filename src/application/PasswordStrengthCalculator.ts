export interface PasswordStrength {
	score: number;
	feedback: string;
}

export class PasswordStrengthCalculator {
	calculate(password: string): PasswordStrength {
		let score = 0;
		const feedback: string[] = [];

		if (password.length === 0) {
			return { score: 0, feedback: 'Enter a password' };
		}

		if (password.length >= 8) score += 20;
		else feedback.push('Use at least 8 characters');

		if (password.length >= 12) score += 10;
		if (password.length >= 16) score += 10;

		if (/[a-z]/.test(password)) score += 10;
		else feedback.push('Add lowercase letters');

		if (/[A-Z]/.test(password)) score += 10;
		else feedback.push('Add uppercase letters');

		if (/[0-9]/.test(password)) score += 10;
		else feedback.push('Add numbers');

		if (/[^a-zA-Z0-9]/.test(password)) score += 10;
		else feedback.push('Add special characters');

		if (/(.)\1{2,}/.test(password)) {
			score -= 10;
			feedback.push('Avoid repeated characters');
		}

		const commonWords = ['password', '123456', 'qwerty', 'admin', 'letmein'];
		if (commonWords.some(word => password.toLowerCase().includes(word))) {
			score -= 20;
			feedback.push('Avoid common words');
		}

		score = Math.max(0, Math.min(100, score));

		let strengthText = '';
		if (score < 30) strengthText = 'Weak';
		else if (score < 60) strengthText = 'Fair';
		else if (score < 80) strengthText = 'Good';
		else strengthText = 'Strong';

		return {
			score,
			feedback: feedback.length > 0 ? `${strengthText}. ${feedback[0]}` : strengthText
		};
	}
}
