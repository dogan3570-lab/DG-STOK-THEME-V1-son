import jwt from 'jsonwebtoken';
const JWT_SECRET = 'ySsgOO3P4RiZ8jtu0MBcVYcXNlYn7IWRyZpHhDBs';
const token = jwt.sign({ sub: 'b5b56b5c-0dcd-4020-a70f-eb3f6108470d', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '7d' });
console.log(token);