import dev from './config.dev';
import prod from './config.prod';

const config = {
	dev,
	prod
};

const mode = process.env.ENV_ID === 'dev' ? 'dev' : 'prod';

export default config[mode];
