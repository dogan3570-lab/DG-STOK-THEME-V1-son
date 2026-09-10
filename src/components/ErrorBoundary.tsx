import React from 'react';

interface Props { children: React.ReactNode; fallback?: React.ReactNode; }
interface State { hasError: boolean; error?: Error; }

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-6 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
          <h3 className="text-red-700 dark:text-red-400 font-semibold mb-2">Bir hata oluştu</h3>
          <p className="text-red-600 dark:text-red-300 text-sm">{this.state.error?.message}</p>
          <button onClick={() => this.setState({ hasError: false })} className="mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700">
            Tekrar Dene
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
