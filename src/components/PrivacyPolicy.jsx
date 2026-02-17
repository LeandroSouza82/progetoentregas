import React from 'react';
import './PrivacyPolicy.css';

const PrivacyPolicy = () => {
    return (
        <div className="privacy-container">
            <div className="privacy-content">
                <h1>Política de Privacidade - V10 Delivery</h1>
                <p className="last-update"><strong>Última atualização:</strong> 6 de fevereiro de 2026</p>

                <section>
                    <h2>1. Coleta de Dados</h2>
                    <p>O V10 Delivery coleta informações necessárias para o funcionamento do serviço de entregas, incluindo:</p>
                    <ul>
                        <li>Nome completo e informações de contato</li>
                        <li>Endereços de entrega e recolha</li>
                        <li>Localização em tempo real dos motoristas (GPS)</li>
                        <li>Histórico de entregas realizadas</li>
                    </ul>
                </section>

                <section>
                    <h2>2. Uso dos Dados</h2>
                    <p>Os dados coletados são utilizados exclusivamente para:</p>
                    <ul>
                        <li>Gerenciar e otimizar rotas de entrega</li>
                        <li>Comunicação entre gestores e motoristas</li>
                        <li>Melhorar a qualidade do serviço prestado</li>
                        <li>Gerar relatórios e estatísticas operacionais</li>
                    </ul>
                </section>

                <section>
                    <h2>3. Segurança</h2>
                    <p>Todos os dados são armazenados de forma segura no Supabase (PostgreSQL), com criptografia end-to-end e proteção contra acessos não autorizados. Utilizamos as melhores práticas de segurança da indústria.</p>
                </section>

                <section>
                    <h2>4. Compartilhamento</h2>
                    <p>Seus dados <strong>não são compartilhados</strong> com terceiros. Mantemos total privacidade das informações coletadas.</p>
                </section>

                <section>
                    <h2>5. Seus Direitos</h2>
                    <p>Você tem direito a acessar, corrigir ou solicitar a exclusão de seus dados a qualquer momento. Entre em contato conosco para exercer esses direitos.</p>
                </section>

                <div className="back-link">
                    <a href="/">← Voltar para a página inicial</a>
                </div>
            </div>
        </div>
    );
};

export default PrivacyPolicy;
