import React from "react";

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        try {
            // eslint-disable-next-line no-console
            console.error('ErrorBoundary caught an error', error, info);
        } catch (e) { }
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 16 }}>
                    <h2>Ocorreu um erro na interface</h2>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{String(this.state.error)}</pre>
                    <button onClick={() => window.location.reload()}>Recarregar</button>
                </div>
            );
        }

        return this.props.children;
    }
}
