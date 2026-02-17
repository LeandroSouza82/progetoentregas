import { io } from 'socket.io-client';

// Usando o seu IP da rede para o celular conseguir conectar
const socket = io('http://192.168.2.127:3000'); // Configurar socket.io-client para apontar para o backend no IP local da rede

export default socket;