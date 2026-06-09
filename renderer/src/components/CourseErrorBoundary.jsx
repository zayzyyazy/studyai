import React from 'react';

export default class CourseErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('CoursePage crashed:', error, info);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 p-8 bg-bg-primary text-center">
          <p className="text-sm text-text-primary font-medium">This course view crashed</p>
          <p className="text-xs text-text-muted max-w-md">{String(this.state.error?.message || this.state.error)}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
